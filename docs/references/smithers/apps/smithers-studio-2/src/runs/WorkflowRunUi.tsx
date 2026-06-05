/**
 * Embeds a workflow's own custom UI for a live run. Workflows can register a UI
 * with the Gateway (served at `uiPath`, e.g. `/workflows/<key>`); when the
 * selected run belongs to such a workflow, the Runs surface defaults to showing
 * that UI here instead of the generic tree/inspector.
 *
 * The UI is a standalone bundle the Gateway serves and boots with its own RPC /
 * websocket clients, so it lives behind an iframe (its own document, its own
 * React). It's mounted same-origin — the studio host proxies `/workflows/*`,
 * `/v1/rpc`, and the run-event socket to the Gateway — so the UI's relative
 * boot paths resolve without extra wiring. We append `?runId=<id>` so a UI that
 * wants to scope to one run can read it from `location.search`.
 */
export function WorkflowRunUi(props: { uiPath: string; runId: string }) {
  const src = `${props.uiPath}?runId=${encodeURIComponent(props.runId)}`;
  return (
    <div className="runs-workflow-ui" data-testid="runs.workflowUi">
      <iframe
        key={src}
        className="runs-workflow-ui-frame"
        src={src}
        title="Workflow UI"
        data-testid="runs.workflowUi.frame"
      />
    </div>
  );
}
