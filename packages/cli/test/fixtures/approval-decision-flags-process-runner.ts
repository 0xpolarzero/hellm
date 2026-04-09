import {
  executeHeadlessRun,
  parseHeadlessCliRequest,
  serializeJsonlEvents,
} from "../../src/index.ts";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  fixedClock,
} from "@hellm/test-support";

if (!import.meta.main) {
  throw new Error("This fixture must run as a process entrypoint.");
}

const outcome = process.env.HELLM_APPROVAL_FIXTURE_OUTCOME === "waiting"
  ? "waiting"
  : "completed";
const args = process.argv.slice(2);
const request = parseHeadlessCliRequest(args);
const runId =
  request.resumeRunId ?? request.approvalDecision?.runId ?? "approval-run";

const smithersBridge = new FakeSmithersWorkflowBridge();
smithersBridge.enqueueResumeResult({
  run: {
    runId,
    threadId: request.threadId,
    workflowId: `workflow:${request.threadId}`,
    status: outcome === "waiting" ? "waiting_approval" : "completed",
    updatedAt: "2026-04-09T09:00:00.000Z",
  },
  status: outcome === "waiting" ? "waiting_approval" : "completed",
  outputs: [],
  ...(outcome === "waiting"
    ? {
        approval: {
          nodeId: "approval-node",
          title: "Approval required",
          summary: "Awaiting reviewer decision.",
          mode: "needsApproval" as const,
        },
      }
    : {}),
  episode: createEpisodeFixture({
    id:
      outcome === "waiting"
        ? "process-approval-flags-waiting"
        : "process-approval-flags-completed",
    threadId: request.threadId,
    source: "smithers",
    status: outcome === "waiting" ? "waiting_approval" : "completed",
    smithersRunId: runId,
  }),
});

const orchestrator = createOrchestrator({
  clock: fixedClock(),
  smithersBridge,
  contextLoader: {
    async load(incoming) {
      return {
        sessionHistory: [],
        repoAndWorktree: { cwd: incoming.cwd },
        agentsInstructions: [],
        relevantSkills: [],
        priorEpisodes: [],
        priorArtifacts: [],
        state: createEmptySessionState({
          sessionId: incoming.threadId,
          sessionCwd: incoming.cwd,
        }),
      };
    },
  },
});

const result = await executeHeadlessRun(request, { orchestrator });
const latestEpisode = result.threadSnapshot.episodes.at(-1);
if (!latestEpisode) {
  throw new Error("Expected latest episode to exist.");
}

process.stdout.write(`${serializeJsonlEvents(result.events)}\n`);
process.stdout.write(
  `${JSON.stringify({
    type: "approval-flags.assertions",
    request,
    approvals: smithersBridge.approvals,
    denials: smithersBridge.denials,
    resumeRequests: smithersBridge.resumeRequests,
    latestEpisodeConclusions: latestEpisode.conclusions,
    latestEpisodeStatus: latestEpisode.status,
  })}\n`,
);
