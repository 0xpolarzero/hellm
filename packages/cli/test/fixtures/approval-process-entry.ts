import { executeHeadlessRun, serializeJsonlEvents } from "@hellm/cli";

const mode = process.argv[2] === "approval" ? "approval" : "clarification";

const result = await executeHeadlessRun({
  threadId: `process-${mode}`,
  prompt:
    mode === "approval"
      ? "Require explicit approval before proceeding."
      : "Need clarification before proceeding.",
  cwd: process.cwd(),
  routeHint: "approval",
  requireApproval: mode === "approval",
});

console.log(serializeJsonlEvents(result.events));
