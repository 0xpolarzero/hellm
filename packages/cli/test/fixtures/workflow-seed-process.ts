import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

const seededObjective = "Seeded objective from process fixture";
const smithersBridge = new FakeSmithersWorkflowBridge();

smithersBridge.enqueueRunResult({
  run: {
    runId: "process-seed-run",
    threadId: "process-seed-thread",
    workflowId: "workflow:process-seed-thread",
    status: "completed",
    updatedAt: "2026-04-08T09:00:00.000Z",
  },
  status: "completed",
  outputs: [],
  episode: createEpisodeFixture({
    id: "process-seed-episode",
    threadId: "process-seed-thread",
    source: "smithers",
    smithersRunId: "process-seed-run",
  }),
});

const orchestrator = createOrchestrator({
  clock: fixedClock(),
  smithersBridge,
  contextLoader: {
    async load(request) {
      return {
        sessionHistory: [],
        repoAndWorktree: { cwd: request.cwd },
        agentsInstructions: [],
        relevantSkills: [],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: request.threadId,
          sessionCwd: request.cwd,
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(
  {
    threadId: "process-seed-thread",
    prompt: "Process fixture prompt should not override objective.",
    cwd: process.cwd(),
    routeHint: "auto",
    workflowSeedInput: {
      objective: seededObjective,
      preferredPath: "smithers-workflow",
      tasks: [
        {
          id: "seed-task-process",
          outputKey: "result",
          prompt: "Run seeded process task.",
          agent: "pi",
        },
      ],
    },
  },
  { orchestrator },
);

console.log(serializeJsonlEvents(result.events));
console.log(
  JSON.stringify({
    type: "seed.assertions",
    classificationPath: result.raw.classification.path,
    classificationReason: result.raw.classification.reason,
    runObjective: smithersBridge.runRequests[0]?.objective,
    workflowObjective: smithersBridge.runRequests[0]?.workflow.objective,
  }),
);
