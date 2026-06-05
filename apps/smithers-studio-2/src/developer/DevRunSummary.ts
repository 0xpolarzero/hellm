/**
 * One row from the gateway `listRuns` RPC — enough to populate the run picker
 * that drives which DevTools snapshot is shown.
 */
export type DevRunSummary = {
  runId: string;
  workflowKey: string | null;
  status: string | null;
  createdAtMs: number | null;
};
