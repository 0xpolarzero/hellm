import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

const mode = process.argv[2] === "resume" ? "resume" : "waiting";
const threadId = "cli-process-smithers";
const runId = "cli-process-smithers-run";
const cwd = process.cwd();

const smithersBridge = new FakeSmithersWorkflowBridge();
if (mode === "resume") {
  smithersBridge.enqueueResumeResult({
    run: {
      runId,
      threadId,
      workflowId: `workflow:${threadId}`,
      status: "completed",
      updatedAt: "2026-04-08T09:05:00.000Z",
    },
    status: "completed",
    outputs: [],
    episode: createEpisodeFixture({
      id: "cli-process-smithers-completed",
      threadId,
      source: "smithers",
      status: "completed",
      smithersRunId: runId,
    }),
  });
} else {
  smithersBridge.enqueueRunResult({
    run: {
      runId,
      threadId,
      workflowId: `workflow:${threadId}`,
      status: "waiting_approval",
      updatedAt: "2026-04-08T09:00:00.000Z",
    },
    status: "waiting_approval",
    outputs: [],
    approval: {
      nodeId: "approve",
      title: "Approve workflow step",
      summary: "Needs approval before continuing.",
      mode: "needsApproval",
    },
    episode: createEpisodeFixture({
      id: "cli-process-smithers-waiting",
      threadId,
      source: "smithers",
      status: "waiting_approval",
      smithersRunId: runId,
    }),
  });
}

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
    threadId,
    prompt:
      mode === "resume"
        ? "Resume the smithers workflow path."
        : "Run the smithers workflow path.",
    cwd,
    routeHint: "smithers-workflow",
    ...(mode === "resume"
      ? { resumeRunId: runId }
      : { requireApproval: true }),
  },
  { orchestrator },
);

console.log(serializeJsonlEvents(result.events));
