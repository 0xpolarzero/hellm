import { create } from "zustand";

/**
 * The run handoff from Workflows -> Runs. Launching a workflow routes the user
 * to the Runs surface (via the shared store's setActiveView) with the freshly
 * created run selected. Per the disjointness rule we MUST NOT add this selection
 * to useStudioStore, so the selected-run id lives in this surface-local slice;
 * the Runs surface reads `pendingRunId` to auto-select the new run.
 */
type WorkflowLaunchHandoffState = {
  pendingRunId: string | null;
  pendingWorkflowKey: string | null;
  setPendingRun: (runId: string, workflowKey: string) => void;
  clearPendingRun: () => void;
};

export const useWorkflowLaunchHandoff = create<WorkflowLaunchHandoffState>((set) => ({
  pendingRunId: null,
  pendingWorkflowKey: null,
  setPendingRun: (runId, workflowKey) => set({ pendingRunId: runId, pendingWorkflowKey: workflowKey }),
  clearPendingRun: () => set({ pendingRunId: null, pendingWorkflowKey: null }),
}));
