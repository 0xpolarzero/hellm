import { executeHeadlessRun } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { EchoPiRuntimeBridge, fixedClock } from "@hellm/test-support";

const cwd = process.env.HELLM_PROCESS_TEST_CWD ?? process.cwd();

const result = await executeHeadlessRun({
  threadId: "process-structured-output",
  prompt: "Return structured output through a process boundary.",
  cwd,
  routeHint: "direct",
}, {
  orchestrator: createOrchestrator({
    clock: fixedClock(),
    piBridge: new EchoPiRuntimeBridge(),
  }),
});

console.log(
  JSON.stringify({
    output: result.output,
    latestEpisodeIdFromSnapshot: result.threadSnapshot.episodes.at(-1)?.id,
  }),
);
