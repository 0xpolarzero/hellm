/**
 * The minimal stat counters shown in the top bar. SEAM: today from
 * `useProjectStats` mock; later the active-run count is a real gateway query
 * and PR/issue counts come from the VCS integration.
 */
export type ProjectStats = {
  activeRuns: number;
  openPrs: number;
  openIssues: number;
};
