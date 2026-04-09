import {
  type SessionState,
  type ThreadSnapshot,
} from "@hellm/session-model";

export interface TuiProjection {
  threadsPane: string[];
  episodeInspector: string[];
  verificationPanel: string[];
  workflowActivity: string[];
  footer: string[];
}

export interface MultiThreadTuiProjection {
  threadsOverview: string[];
  activeThread: TuiProjection;
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

export function projectSessionState(
  state: SessionState,
  activeThreadId?: string,
): MultiThreadTuiProjection {
  const threadId = activeThreadId ?? state.threads.at(-1)?.id;
  const threadLines: string[] = [];

  if (state.threads.length === 0) {
    threadLines.push("no threads");
  } else {
    for (const thread of state.threads) {
      const marker = thread.id === threadId ? ">" : " ";
      const episodeCount = state.episodes.filter(
        (episode) => episode.threadId === thread.id,
      ).length;
      threadLines.push(
        `${marker} ${thread.id} [${thread.kind}] ${thread.status} (${episodeCount} episodes)`,
      );
    }
  }

  let activeThread: TuiProjection;
  if (threadId) {
    const thread = state.threads.find((candidate) => candidate.id === threadId);
    if (thread) {
      const episodes = state.episodes.filter((episode) => episode.threadId === threadId);
      const artifactIds = new Set(
        episodes.flatMap((episode) => episode.artifacts.map((artifact) => artifact.id)),
      );
      const artifacts = state.artifacts.filter((artifact) => artifactIds.has(artifact.id));
      const workflowRuns = state.workflowRuns.filter(
        (run) => run.threadId === threadId,
      );

      activeThread = projectThreadSnapshot({
        thread,
        episodes,
        artifacts,
        verification: state.verification,
        alignment: state.alignment,
        workflowRuns,
      });
    } else {
      activeThread = emptyProjection(state);
    }
  } else {
    activeThread = emptyProjection(state);
  }

  return {
    threadsOverview: threadLines,
    activeThread,
  };
}

function emptyProjection(state: SessionState): TuiProjection {
  return {
    threadsPane: ["no active thread"],
    episodeInspector: ["episode none"],
    verificationPanel: [`overall ${state.verification.overallStatus}`],
    workflowActivity: ["workflow none"],
    footer: [
      `session ${state.alignment.sessionCwd}`,
      `worktree ${state.alignment.activeWorktreePath ?? state.alignment.sessionCwd}`,
      state.alignment.aligned ? "aligned" : "not aligned",
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

export function renderMultiThreadProjection(
  projection: MultiThreadTuiProjection,
): string[] {
  return [
    "[threads-overview]",
    ...projection.threadsOverview,
    "",
    ...renderProjection(projection.activeThread),
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

export function renderMultiThreadTuiFrame(
  projection: MultiThreadTuiProjection,
  input: { width: number; height: number },
): string[] {
  return renderMultiThreadProjection(projection)
    .slice(0, input.height)
    .map((line) =>
      line.length <= input.width ? line : `${line.slice(0, Math.max(input.width - 3, 0))}...`
    );
}
