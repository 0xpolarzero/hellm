import {
  executeHeadlessRun,
  serializeJsonlEvents,
  type HeadlessRequest,
} from "../../src/index.ts";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

if (!import.meta.main) {
  throw new Error("This module must be executed as an entrypoint.");
}

const [serializedRequest] = process.argv.slice(2);
if (!serializedRequest) {
  throw new Error("Expected a serialized HeadlessRequest as the first argument.");
}

const request = JSON.parse(serializedRequest) as HeadlessRequest;
const piBridge = new FakePiRuntimeBridge();
piBridge.enqueueResult({
  status: "completed",
  episode: createEpisodeFixture({
    id: `${request.threadId}:pi`,
    threadId: request.threadId,
    source: "pi-worker",
    conclusions: [`Pi worker fixture output for ${request.threadId}.`],
    provenance: {
      executionPath: "pi-worker",
      actor: "pi-worker",
      notes: "Process fixture pi worker result.",
    },
  }),
});

const smithersBridge = new FakeSmithersWorkflowBridge();
smithersBridge.enqueueRunResult({
  run: {
    runId: `run:${request.threadId}`,
    threadId: request.threadId,
    workflowId: `workflow:${request.threadId}`,
    status: "completed",
    updatedAt: "2026-04-08T09:00:00.000Z",
  },
  status: "completed",
  outputs: [],
  episode: createEpisodeFixture({
    id: `${request.threadId}:smithers`,
    threadId: request.threadId,
    source: "smithers",
    smithersRunId: `run:${request.threadId}`,
    conclusions: [`Smithers fixture output for ${request.threadId}.`],
    provenance: {
      executionPath: "smithers-workflow",
      actor: "smithers",
      notes: "Process fixture smithers workflow result.",
    },
  }),
});

const verificationRunner = new FakeVerificationRunner();
verificationRunner.enqueueResult({
  status: "passed",
  records: [],
  artifacts: [],
});

const orchestrator = createOrchestrator({
  clock: fixedClock(),
  piBridge,
  smithersBridge,
  verificationRunner,
  contextLoader: {
    async load(nextRequest) {
      return {
        sessionHistory: [],
        repoAndWorktree: {
          cwd: nextRequest.cwd,
          ...(nextRequest.worktreePath
            ? { worktreePath: nextRequest.worktreePath }
            : {}),
        },
        agentsInstructions: [],
        relevantSkills: [],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: nextRequest.threadId,
          sessionCwd: nextRequest.cwd,
          ...(nextRequest.worktreePath
            ? { activeWorktreePath: nextRequest.worktreePath }
            : {}),
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(request, { orchestrator });

console.log(serializeJsonlEvents(result.events));
