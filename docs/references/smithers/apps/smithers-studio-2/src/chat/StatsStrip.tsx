import { useProjectStats } from "./projects/useProjectStats";

/**
 * The compact stat counters in the top bar. SEAM: counts come from
 * `useProjectStats` (mock today). Minimalistic by design — a few numbers, no
 * chrome.
 */
export function StatsStrip({ projectId }: { projectId: string }) {
  const stats = useProjectStats(projectId);
  return (
    <div className="stats-strip" data-testid="stats-strip">
      <span className="stat" title="Active runs">
        ▶ {stats.activeRuns}
      </span>
      <span className="stat" title="Open PRs">
        ◷ {stats.openPrs}
      </span>
      <span className="stat" title="Open issues">
        ○ {stats.openIssues}
      </span>
    </div>
  );
}
