import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
} from "@hellm/session-model";

export interface TuiProjection {
  threadsPane: string[];
  episodeInspector: string[];
  verificationPanel: string[];
  workflowActivity: string[];
  footer: string[];
}

export function projectThreadSnapshot(snapshot: ThreadSnapshot): TuiProjection {
  const latestEpisode = snapshot.episodes.at(-1);
  const verificationLines = Object.values(snapshot.verification.byKind).length
    ? Object.values(snapshot.verification.byKind).map(
        (record) => `${record.kind}: ${record.status} - ${record.summary}`,
      )
    : ["verification: unknown"];

  return {
    threadsPane: [
      `thread ${snapshot.thread.id}`,
      `kind ${snapshot.thread.kind}`,
      `status ${snapshot.thread.status}`,
      `objective ${snapshot.thread.objective}`,
    ],
    episodeInspector: latestEpisode
      ? [
          `episode ${latestEpisode.id}`,
          `source ${latestEpisode.source}`,
          `status ${latestEpisode.status}`,
          ...latestEpisode.conclusions.map((line) => `conclusion ${line}`),
          ...latestEpisode.unresolvedIssues.map((line) => `issue ${line}`),
          ...latestEpisode.followUpSuggestions.map((line) => `follow-up ${line}`),
        ]
      : ["episode none"],
    verificationPanel: [
      `overall ${snapshot.verification.overallStatus}`,
      ...verificationLines,
    ],
    workflowActivity:
      snapshot.workflowRuns.length > 0
        ? snapshot.workflowRuns.map(
            (run) => `${run.workflowId}: ${run.status} (${run.runId})`,
          )
        : ["workflow none"],
    footer: [
      `session ${snapshot.alignment.sessionCwd}`,
      `worktree ${snapshot.alignment.activeWorktreePath ?? snapshot.alignment.sessionCwd}`,
      snapshot.alignment.aligned ? "aligned" : "not aligned",
    ],
  };
}

export function renderProjection(projection: TuiProjection): string[] {
  return [
    "[threads]",
    ...projection.threadsPane,
    "[episode]",
    ...projection.episodeInspector,
    "[verification]",
    ...projection.verificationPanel,
    "[workflow]",
    ...projection.workflowActivity,
    "[footer]",
    ...projection.footer,
  ];
}

export const projectTui = projectThreadSnapshot;

export function renderTuiFrame(
  projection: TuiProjection,
  input: { width: number; height: number },
): string[] {
  return renderProjection(projection)
    .slice(0, input.height)
    .map((line) =>
      line.length <= input.width ? line : `${line.slice(0, Math.max(input.width - 3, 0))}...`
    );
}

if (import.meta.main) {
  const timestamp = new Date().toISOString();
  const thread = createThread({
    id: "demo",
    kind: "direct",
    objective: "Render an orchestration-aware TUI projection.",
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const episode = createEpisode({
    id: "demo:episode",
    threadId: thread.id,
    source: "orchestrator",
    objective: thread.objective,
    status: "completed",
    conclusions: ["Projection contract initialized."],
    artifacts: [
      createArtifact({
        id: "demo:artifact",
        kind: "note",
        description: "TUI demo artifact",
        createdAt: timestamp,
      }),
    ],
    provenance: {
      executionPath: "direct",
      actor: "orchestrator",
      notes: "Demo projection only.",
    },
    startedAt: timestamp,
    completedAt: timestamp,
  });
  const projection = projectThreadSnapshot({
    thread,
    episodes: [episode],
    artifacts: episode.artifacts,
    verification: createGlobalVerificationState(),
    alignment: createSessionWorktreeAlignment({
      sessionCwd: process.cwd(),
    }),
    workflowRuns: [],
  });

  console.log(renderProjection(projection).join("\n"));
}
