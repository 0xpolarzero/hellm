import { createOrchestrator } from "@hellm/orchestrator";

const orchestrator = createOrchestrator();
const snapshot = orchestrator.beginThread({
  goal: "Scaffold the pi-first, Slate-like coding agent runtime.",
  threadId: "bootstrap",
});

console.log(`[hellm/tui] ${snapshot.goal}`);
console.log(
  `[hellm/tui] orchestrator=${orchestrator.id} episodes=${snapshot.episodes.length}`,
);
