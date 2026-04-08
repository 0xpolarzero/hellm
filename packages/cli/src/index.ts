import { createOrchestrator } from "@hellm/orchestrator";

const orchestrator = createOrchestrator();

console.log(`[hellm/cli] orchestrator=${orchestrator.id}`);
