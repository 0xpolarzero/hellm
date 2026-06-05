import type { ProjectStats } from "./ProjectStats";

/**
 * SEAM: per-project stat counters. Deterministic stand-ins keyed by project id
 * until the gateway run counts + VCS PR/issue counts are wired. Returning a
 * stable object per id keeps renders cheap.
 */
const STATS: Record<string, ProjectStats> = {
  "acme-web": { activeRuns: 3, openPrs: 2, openIssues: 5 },
  payments: { activeRuns: 1, openPrs: 4, openIssues: 2 },
  infra: { activeRuns: 0, openPrs: 1, openIssues: 7 },
  mobile: { activeRuns: 2, openPrs: 0, openIssues: 3 },
};

const EMPTY: ProjectStats = { activeRuns: 0, openPrs: 0, openIssues: 0 };

export function useProjectStats(projectId: string): ProjectStats {
  return STATS[projectId] ?? EMPTY;
}
