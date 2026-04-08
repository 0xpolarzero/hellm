import {
  createOrchestrator,
  type Orchestrator,
  type OrchestratorRequest,
  type OrchestratorRunResult,
  type WorkflowSeedInput,
} from "@hellm/orchestrator";
import type { ThreadSnapshot } from "@hellm/session-model";

export type JsonlEvent =
  | {
      type: "run.started";
      orchestratorId: string;
      threadId: string;
    }
  | {
      type: "run.classified";
      path: OrchestratorRunResult["classification"]["path"];
      reason: string;
    }
  | {
      type: "run.episode";
      episodeId: string;
      status: ThreadSnapshot["episodes"][number]["status"];
      source: ThreadSnapshot["episodes"][number]["source"];
    }
  | {
      type: "run.completed" | "run.waiting";
      threadId: string;
      status: ThreadSnapshot["thread"]["status"];
      latestEpisodeId: string;
    };

export interface HeadlessRequest extends OrchestratorRequest {
  workflowSeedInput?: WorkflowSeedInput;
}

export interface HeadlessStructuredOutput {
  threadId: string;
  status: ThreadSnapshot["thread"]["status"];
  latestEpisodeId: string;
  summary: string;
  workflowRunIds: string[];
}

export interface HeadlessResult {
  orchestratorId: string;
  threadSnapshot: ThreadSnapshot;
  output: HeadlessStructuredOutput;
  events: JsonlEvent[];
  raw: OrchestratorRunResult;
}

export async function executeHeadlessRun(
  request: HeadlessRequest,
  options: { orchestrator?: Orchestrator } = {},
): Promise<HeadlessResult> {
  const orchestrator = options.orchestrator ?? createOrchestrator();
  const raw = await orchestrator.run(request);
  const events = createJsonlEvents(orchestrator, raw);
  const latestEpisode = raw.threadSnapshot.episodes.at(-1);
  if (!latestEpisode) {
    throw new Error("Headless execution did not produce an episode.");
  }

  return {
    orchestratorId: orchestrator.id,
    threadSnapshot: raw.threadSnapshot,
    output: {
      threadId: raw.threadSnapshot.thread.id,
      status: raw.threadSnapshot.thread.status,
      latestEpisodeId: latestEpisode.id,
      summary:
        latestEpisode.conclusions[0] ??
        latestEpisode.followUpSuggestions[0] ??
        latestEpisode.objective,
      workflowRunIds: raw.threadSnapshot.workflowRuns.map((run) => run.runId),
    },
    events,
    raw,
  };
}

export function createJsonlEvents(
  orchestrator: Orchestrator,
  result: OrchestratorRunResult,
): JsonlEvent[] {
  const latestEpisode = result.threadSnapshot.episodes.at(-1);
  if (!latestEpisode) {
    throw new Error("Cannot build JSONL events without an episode.");
  }

  return [
    {
      type: "run.started",
      orchestratorId: orchestrator.id,
      threadId: result.threadSnapshot.thread.id,
    },
    {
      type: "run.classified",
      path: result.classification.path,
      reason: result.classification.reason,
    },
    {
      type: "run.episode",
      episodeId: latestEpisode.id,
      status: latestEpisode.status,
      source: latestEpisode.source,
    },
    {
      type: result.completion.isComplete ? "run.completed" : "run.waiting",
      threadId: result.threadSnapshot.thread.id,
      status: result.threadSnapshot.thread.status,
      latestEpisodeId: latestEpisode.id,
    },
  ];
}

export function serializeJsonlEvents(events: readonly JsonlEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

if (import.meta.main) {
  const result = await executeHeadlessRun({
    threadId: "cli",
    prompt: "Describe the current workspace contract surface.",
    cwd: process.cwd(),
    routeHint: "direct",
  });

  console.log(serializeJsonlEvents(result.events));
}
