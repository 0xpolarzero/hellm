import type { WorkspaceSessionSummary } from "./chat-rpc";

export function sortVisibleSessionsByRecency(
  sessions: WorkspaceSessionSummary[],
): WorkspaceSessionSummary[] {
  return sessions.toSorted(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}
