import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";
import { createOrchestrator } from "@hellm/orchestrator";
import { EchoPiRuntimeBridge, fixedClock } from "@hellm/test-support";

const cwd = process.env.HELLM_PROCESS_TEST_CWD ?? process.cwd();

const result = await executeHeadlessRun({
  threadId: "cli-direct-default",
  prompt: "Summarize the current workspace state.",
  cwd,
}, {
  orchestrator: createOrchestrator({
    clock: fixedClock(),
    piBridge: new EchoPiRuntimeBridge(),
  }),
});

console.log(serializeJsonlEvents(result.events));
