import { StatusPill } from "../cards/StatusPill";
import { findNode } from "../runs/Run";
import { RunTree } from "../runs/RunTree";
import { GatewayNodeDetail } from "./GatewayNodeDetail";
import { WorkflowRunUi } from "./WorkflowRunUi";
import {
  useGatewayInspectorStore,
  type GatewayRunView,
} from "./gatewayInspectorStore";
import { useGatewayStore } from "./gatewayStore";
import "./gateway.css";

/**
 * The inspector surface for a gateway-backed run. Its header carries the toggle
 * the feature is about: when the run's workflow ships a custom UI, switch
 * between that UI (an embedded iframe) and the native node tree + node detail —
 * the same inspector chrome the local runs use. Defaults to the workflow's own
 * UI when present, falling back to the native view otherwise.
 *
 * Data (snapshot tree, node output, status) comes from the gateway store, kept
 * live by the run-snapshot poll the route binding starts on open.
 */
export function GatewayRunInspector({
  workflowKey,
  runId,
}: {
  workflowKey: string;
  runId: string;
}) {
  const view = useGatewayStore((state) => state.runViews[runId]);
  const uiPath = useGatewayStore((state) => state.uiPathFor(workflowKey));
  const title = useGatewayStore(
    (state) =>
      state.workflows.find((workflow) => workflow.key === workflowKey)
        ?.readableName ?? workflowKey,
  );
  const fetchOutput = useGatewayStore((state) => state.fetchOutput);
  const storedView = useGatewayInspectorStore((state) => state.viewByRun[runId]);
  const selectedNodeId = useGatewayInspectorStore(
    (state) => state.selectedNodeByRun[runId],
  );
  const setView = useGatewayInspectorStore((state) => state.setView);
  const selectNode = useGatewayInspectorStore((state) => state.selectNode);

  const effectiveView: GatewayRunView = storedView ?? (uiPath ? "flow" : "inspector");
  const tree = view?.tree ?? null;
  const activeNodeId = selectedNodeId ?? tree?.id;
  const selected =
    tree && activeNodeId ? findNode(tree, activeNodeId) ?? tree : null;

  const onSelect = (nodeId: string) => {
    selectNode(runId, nodeId);
    void fetchOutput(runId, nodeId);
  };

  return (
    <section className="surface" data-testid="gateway-run-inspector">
      <header className="surface-head">
        <span className="surface-title">{title}</span>
        {view ? <StatusPill status={view.status} /> : null}
        <div className="seg">
          {uiPath ? (
            <button
              type="button"
              className={effectiveView === "flow" ? "is-on" : ""}
              data-testid="gateway-view-flow"
              onClick={() => setView(runId, "flow")}
            >
              Workflow UI
            </button>
          ) : null}
          <button
            type="button"
            className={effectiveView === "inspector" ? "is-on" : ""}
            data-testid="gateway-view-inspector"
            onClick={() => setView(runId, "inspector")}
          >
            Inspector
          </button>
        </div>
      </header>

      {effectiveView === "flow" && uiPath ? (
        <WorkflowRunUi uiPath={uiPath} runId={runId} />
      ) : !view?.loaded ? (
        <div className="surface-empty">Loading run…</div>
      ) : !tree ? (
        <div className="surface-empty">No execution tree yet.</div>
      ) : (
        <div className="inspector-body">
          <div className="tree-pane">
            <RunTree
              root={tree}
              selectedId={activeNodeId ?? ""}
              onSelect={onSelect}
            />
          </div>
          {selected ? <GatewayNodeDetail runId={runId} node={selected} /> : null}
        </div>
      )}
    </section>
  );
}
