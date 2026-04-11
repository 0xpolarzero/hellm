import type { WorkspaceSessionSummary } from "./chat-rpc";

export function sortVisibleSessionsByRecency(
  sessions: WorkspaceSessionSummary[],
): WorkspaceSessionSummary[] {
  return [...sessions].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}
