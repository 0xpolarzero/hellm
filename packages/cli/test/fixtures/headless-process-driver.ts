import {
  executeHeadlessRun,
  serializeJsonlEvents,
  type HeadlessRequest,
} from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

type ProcessScenario =
  | "direct-completed"
  | "approval-waiting"
  | "pi-blocked"
  | "missing-episode";

const scenario = normalizeScenario(process.env.HELLM_PROCESS_SCENARIO);
const cwd = process.env.HELLM_PROCESS_CWD ?? process.cwd();
const threadId = process.env.HELLM_PROCESS_THREAD_ID ?? `process-${scenario}`;

const contextLoader = {
  async load(request: HeadlessRequest) {
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
};

const baseRequest: Pick<HeadlessRequest, "threadId" | "cwd"> = {
  threadId,
  cwd,
};

let request: HeadlessRequest;
let orchestrator = createOrchestrator({
  clock: fixedClock(),
  contextLoader,
});

switch (scenario) {
  case "direct-completed": {
    request = {
      ...baseRequest,
      prompt: "Run direct process scenario.",
      routeHint: "direct",
    };
    break;
  }
  case "approval-waiting": {
    request = {
      ...baseRequest,
      prompt: "Wait for approval before continuing.",
      routeHint: "approval",
      requireApproval: true,
    };
    break;
  }
  case "pi-blocked": {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "blocked",
      episode: createEpisodeFixture({
        id: "process-blocked-episode",
        threadId,
        source: "pi-worker",
        status: "blocked",
      }),
    });

    orchestrator = createOrchestrator({
      clock: fixedClock(),
      contextLoader,
      piBridge,
    });
    request = {
      ...baseRequest,
      prompt: "Run blocked pi-worker process scenario.",
      routeHint: "pi-worker",
    };
    break;
  }
  case "missing-episode": {
    request = {
      ...baseRequest,
      prompt: "Simulate missing episode output.",
      routeHint: "direct",
    };

    const baseRun = orchestrator.run.bind(orchestrator);
    orchestrator.run = async (input) => {
      const result = await baseRun(input);
      return {
        ...result,
        threadSnapshot: {
          ...result.threadSnapshot,
          episodes: [],
        },
      };
    };
    break;
  }
}

const result = await executeHeadlessRun(request, { orchestrator });
process.stdout.write(serializeJsonlEvents(result.events));

function normalizeScenario(rawScenario?: string): ProcessScenario {
  if (
    rawScenario === "direct-completed" ||
    rawScenario === "approval-waiting" ||
    rawScenario === "pi-blocked" ||
    rawScenario === "missing-episode"
  ) {
    return rawScenario;
  }
  return "direct-completed";
}
