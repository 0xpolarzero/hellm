import type {
  PromptTarget,
  WorkspacePaneSurfaceTarget,
  WorkspaceSessionSummary,
} from "../shared/workspace-contract";

type SurfaceTitleTarget = PromptTarget | WorkspacePaneSurfaceTarget | null | undefined;

export function getSurfaceDisplayTitle(
  target: SurfaceTitleTarget,
  sessions: readonly WorkspaceSessionSummary[],
  fallback = "Surface",
): string {
  if (!target) {
    return fallback;
  }

  if (target.surface === "handler") {
    const thread = sessions
      .find((session) => session.id === target.workspaceSessionId)
      ?.sidebarThreads?.find((candidate) => candidate.threadId === target.threadId);
    return thread?.title?.trim() || "Handler Thread";
  }

  if (target.surface === "orchestrator") {
    return (
      sessions.find((session) => session.id === target.workspaceSessionId)?.title?.trim() ||
      fallback
    );
  }

  return fallback;
}
