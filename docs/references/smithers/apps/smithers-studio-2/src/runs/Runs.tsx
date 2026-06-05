import "./runs.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { LiveRunLayout } from "./LiveRunLayout";
import { RunHistoryList } from "./RunHistoryList";
import { RunInspector } from "./RunInspector";
import { RunToolbar, type RunViewMode } from "./RunToolbar";
import { RunTree } from "./RunTree";
import { WorkflowRunUi } from "./WorkflowRunUi";
import { findNode } from "./findNode";
import { useRunEvents } from "./useRunEvents";
import { useRunsBadgeStore } from "./runsBadgeStore";
import { useRunsData } from "./useRunsData";

/**
 * The Runs surface — the heart of the ops console. A run-history rail (with an
 * approvals filter) on the left; the responsive live-run layout (tree pane +
 * inspector) on the right. Approvals are surfaced three ways: a list filter, an
 * inline gate in the inspector, and the nav badge count (runsBadgeStore).
 */
export function Runs() {
  const data = useRunsData();
  const events = useRunEvents(data.selectedRunId);
  const setPendingApprovals = useRunsBadgeStore((s) => s.setPendingApprovals);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<RunViewMode>("workflow");

  // The mounted custom-UI path for the selected run's workflow, if it ships one.
  const customUiPath = data.runState?.workflowKey
    ? data.workflowUiPaths[data.runState.workflowKey]
    : undefined;

  // Keep the nav badge in sync with the live pending-approval count.
  useEffect(() => {
    setPendingApprovals(data.approvals.length);
  }, [data.approvals.length, setPendingApprovals]);

  // Live event -> data refresh: every WS run.event frame bumps events.eventEpoch.
  // Debounce a refresh of the SELECTED RUN (getRun + getDevToolsSnapshot) so a
  // burst of log frames collapses into a single round trip, surfacing the run's
  // new state/tree/completion without re-selecting. The run/approval LISTS are
  // intentionally NOT re-fetched here — the 2s poll in useRunsData is their
  // floor — so a chatty run doesn't hammer the gateway with listRuns/
  // listApprovals/listWorkflows on every event burst.
  const refreshRef = useRef({ refreshRun: data.refreshRun });
  refreshRef.current = { refreshRun: data.refreshRun };
  useEffect(() => {
    if (events.eventEpoch === 0) return;
    const timer = setTimeout(() => {
      refreshRef.current.refreshRun();
    }, 400);
    return () => clearTimeout(timer);
  }, [events.eventEpoch]);

  // Reset node selection when the run changes; default to the run root.
  useEffect(() => {
    setSelectedNodeId(data.runState?.tree?.id);
    setSheetOpen(false);
  }, [data.runState?.runId, data.runState?.tree?.id]);

  // When the selected run changes, default the view to the workflow's own UI
  // whenever it ships one; otherwise fall back to the default tree/inspector.
  // A run lacking a custom UI never shows the workflow view.
  useEffect(() => {
    setViewMode(customUiPath ? "workflow" : "default");
  }, [data.runState?.runId, customUiPath]);

  const selectedNode = useMemo(
    () => findNode(data.runState?.tree ?? null, selectedNodeId),
    [data.runState, selectedNodeId],
  );

  const nodeApproval = useMemo(
    () =>
      data.approvals.find(
        (approval) =>
          approval.runId === data.selectedRunId && approval.nodeId === selectedNodeId,
      ),
    [data.approvals, data.selectedRunId, selectedNodeId],
  );

  const onSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSheetOpen(true);
  };

  const onApprovalResolved = () => {
    data.refresh();
    data.refreshRun();
  };

  return (
    <section className="runs-surface" data-testid="view.runs">
      <header className="runs-header">
        <h2 className="runs-title">Runs</h2>
        {data.error ? <span className="runs-header-error">{data.error}</span> : null}
      </header>

      <div className="runs-body">
        <aside className="runs-rail">
          <RunHistoryList
            runs={data.runs}
            approvals={data.approvals}
            selectedRunId={data.selectedRunId}
            onSelectRun={data.selectRun}
          />
        </aside>

        <div className="runs-main">
          {data.selectedRunId && data.runState ? (
            <>
              <RunToolbar
                run={data.runState}
                streaming={events.streaming}
                onChanged={() => {
                  data.refresh();
                  data.refreshRun();
                }}
                customUiAvailable={Boolean(customUiPath)}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
              />
              {customUiPath && viewMode === "workflow" ? (
                <WorkflowRunUi uiPath={customUiPath} runId={data.selectedRunId} />
              ) : (
                <LiveRunLayout
                  hasSelection={Boolean(selectedNode)}
                  sheetOpen={sheetOpen}
                  onCloseSheet={() => setSheetOpen(false)}
                  tree={
                    <RunTree
                      tree={data.runState.tree}
                      selectedNodeId={selectedNodeId}
                      lastLogByNode={events.lastLogByNode}
                      onSelectNode={onSelectNode}
                    />
                  }
                  inspector={
                    selectedNode ? (
                      <RunInspector
                        runId={data.selectedRunId}
                        node={selectedNode}
                        approval={nodeApproval}
                        events={events.lines}
                        onApprovalResolved={onApprovalResolved}
                        onClose={() => setSheetOpen(false)}
                      />
                    ) : (
                      <div className="runs-inspector-empty">Select a node to inspect it.</div>
                    )
                  }
                />
              )}
            </>
          ) : (
            <div className="runs-empty" data-testid="runs.empty">
              {data.loadingList
                ? "Loading runs…"
                : data.runs.length === 0
                  ? "No runs yet. Launch a workflow to start one."
                  : "No run selected. Pick a run from the list."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
