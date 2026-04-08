import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";

const result = await executeHeadlessRun({
  threadId: "cli-direct-default",
  prompt: "Summarize the current workspace state.",
  cwd: process.cwd(),
});

console.log(serializeJsonlEvents(result.events));
