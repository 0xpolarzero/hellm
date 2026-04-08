import { executeHeadlessRun } from "@hellm/cli";

const result = await executeHeadlessRun({
  threadId: "process-structured-output",
  prompt: "Return structured output through a process boundary.",
  cwd: process.cwd(),
  routeHint: "direct",
});

console.log(
  JSON.stringify({
    output: result.output,
    latestEpisodeIdFromSnapshot: result.threadSnapshot.episodes.at(-1)?.id,
  }),
);
