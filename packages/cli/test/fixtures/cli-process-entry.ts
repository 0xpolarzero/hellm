import {
  executeHeadlessRun,
  parseHeadlessCliRequest,
  serializeJsonlEvents,
} from "../../src/index.ts";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import { EchoPiRuntimeBridge, fixedClock } from "@hellm/test-support";

if (!import.meta.main) {
  throw new Error("This fixture must run as a process entrypoint.");
}

const request = parseHeadlessCliRequest(process.argv.slice(2));
const orchestrator = createOrchestrator({
  clock: fixedClock(),
  piBridge: new EchoPiRuntimeBridge(),
  contextLoader: {
    async load(incoming) {
      return {
        sessionHistory: [],
        repoAndWorktree: {
          cwd: incoming.cwd,
          ...(incoming.worktreePath
            ? { worktreePath: incoming.worktreePath }
            : {}),
        },
        agentsInstructions: [],
        relevantSkills: [],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: incoming.threadId,
          sessionCwd: incoming.cwd,
          ...(incoming.worktreePath
            ? { activeWorktreePath: incoming.worktreePath }
            : {}),
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(request, { orchestrator });
process.stdout.write(`${serializeJsonlEvents(result.events)}\n`);
