import { executeHeadlessRun } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

const cwd = process.env.HELLM_PROCESS_TEST_CWD;
const worktreePath = process.env.HELLM_PROCESS_TEST_WORKTREE;
const sessionFile = process.env.HELLM_PROCESS_TEST_SESSION_FILE;

if (!cwd) {
  throw new Error("HELLM_PROCESS_TEST_CWD is required.");
}

if (!worktreePath) {
  throw new Error("HELLM_PROCESS_TEST_WORKTREE is required.");
}

if (!sessionFile) {
  throw new Error("HELLM_PROCESS_TEST_SESSION_FILE is required.");
}

const piBridge = new FakePiRuntimeBridge();
piBridge.enqueueResult({
  status: "completed",
  episode: createEpisodeFixture({
    id: "process-pi-episode",
    threadId: "process-pi-worker",
    source: "pi-worker",
    worktreePath,
    conclusions: ["Worker completed from process harness."],
  }),
});

const orchestrator = createOrchestrator({
  clock: fixedClock(),
  piBridge,
  contextLoader: {
    async load(request) {
      return {
        sessionHistory: [],
        repoAndWorktree: {
          cwd: request.cwd,
          ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
        },
        agentsInstructions: ["Read docs/prd.md"],
        relevantSkills: ["tests"],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: request.threadId,
          sessionCwd: request.cwd,
          ...(request.worktreePath
            ? { activeWorktreePath: request.worktreePath }
            : {}),
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(
  {
    threadId: "process-pi-worker",
    prompt: "Run the internal raw pi execution primitive.",
    cwd,
    worktreePath,
    routeHint: "pi-worker",
    resumeRunId: "pi-process-resume",
  },
  { orchestrator },
);

const harness = new FileBackedSessionJsonlHarness({
  filePath: sessionFile,
  sessionId: "process-pi-worker",
  cwd,
});

const workerRequest = piBridge.workerRequests[0];
if (!workerRequest) {
  throw new Error("Expected one pi worker request from process harness.");
}

console.log(
  JSON.stringify({
    eventTypes: result.events.map((event) => event.type),
    classification: result.raw.classification,
    completion: result.raw.completion,
    workerRequest: {
      runtimeTransition: workerRequest.runtimeTransition,
      scopedContext: {
        relevantPaths: workerRequest.scopedContext.relevantPaths,
        priorEpisodeIds: workerRequest.scopedContext.priorEpisodeIds,
      },
      toolScope: workerRequest.toolScope,
      completion: workerRequest.completion,
    },
    sessionJsonlLineCount: harness.lines().length,
    reconstructedEpisodeIds: harness.reconstruct().episodes.map(
      (episode) => episode.id,
    ),
  }),
);
