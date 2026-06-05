import type { WorkflowEntry } from "./workflowsApi";
import { useWorkflowDetail } from "./useWorkflowDetail";
import { WorkflowLaunchForm } from "./WorkflowLaunchForm";

/**
 * The right pane: view a workflow's source/summary and launch it with arguments.
 * The header carries the launch action; below it a Launch / Source tab switch.
 * On a successful launch, `onLaunched` hands the new run id back to the surface
 * so it can route to Runs with that run selected.
 */
export function WorkflowDetail({
  entry,
  onLaunched,
}: {
  entry: WorkflowEntry | null;
  onLaunched: (runId: string, workflowKey: string) => void;
}) {
  const detail = useWorkflowDetail(entry);

  if (!entry) {
    return (
      <div className="wf-detail-empty" data-testid="wf.detail.empty">
        Select a workflow to view its source and launch it.
      </div>
    );
  }

  const handleLaunch = async () => {
    const result = await detail.launch();
    if (result) onLaunched(result.runId, result.workflowKey);
  };

  const showSource = entry.segment === "local" || entry.segment === "remote";

  return (
    <section className="wf-detail" data-testid="wf.detail">
      <header className="wf-detail-header">
        <div className="wf-detail-heading">
          <h3 className="wf-detail-name">{entry.name}</h3>
          {entry.description ? <p className="wf-detail-desc">{entry.description}</p> : null}
        </div>
        <button
          type="button"
          className="wf-launch-button"
          data-testid="wf.launch.button"
          disabled={detail.launching}
          onClick={() => void handleLaunch()}
        >
          {detail.launching ? "Launching…" : "Launch"}
        </button>
      </header>

      {showSource ? (
        <nav className="wf-detail-tabs" role="tablist" aria-label="Workflow detail">
          <button
            type="button"
            role="tab"
            id="wf-detail-tab-launch"
            aria-selected={detail.tab === "launch"}
            aria-controls="wf-detail-panel"
            className={`wf-detail-tab${detail.tab === "launch" ? " wf-detail-tab--active" : ""}`}
            data-testid="wf.detail.tab.launch"
            onClick={() => detail.setTab("launch")}
          >
            Launch
          </button>
          <button
            type="button"
            role="tab"
            id="wf-detail-tab-source"
            aria-selected={detail.tab === "source"}
            aria-controls="wf-detail-panel"
            className={`wf-detail-tab${detail.tab === "source" ? " wf-detail-tab--active" : ""}`}
            data-testid="wf.detail.tab.source"
            onClick={() => detail.setTab("source")}
          >
            Source
          </button>
        </nav>
      ) : null}

      <div
        className="wf-detail-body"
        id={showSource ? "wf-detail-panel" : undefined}
        role={showSource ? "tabpanel" : undefined}
        aria-labelledby={
          showSource ? (detail.tab === "source" ? "wf-detail-tab-source" : "wf-detail-tab-launch") : undefined
        }
      >
        {detail.tab === "source" && showSource ? (
          <div className="wf-source" data-testid="wf.detail.source">
            {detail.loadingDetail ? (
              <div className="wf-list-state">Loading source…</div>
            ) : detail.source ? (
              <>
                <div className="wf-source-path">{detail.source.path}</div>
                <pre className="wf-source-code">{detail.source.source}</pre>
              </>
            ) : (
              <div className="wf-list-state wf-list-state--error">
                {detail.detailError ?? "No source available."}
              </div>
            )}
          </div>
        ) : (
          <div className="wf-detail-launch">
            <WorkflowLaunchForm
              fields={detail.fields}
              values={detail.fieldValues}
              errors={detail.fieldErrors}
              freeform={detail.freeform}
              onFieldChange={detail.setFieldValue}
              onFreeformChange={detail.setFreeform}
            />
            {detail.launchMessage ? (
              <div
                className={`wf-launch-message${detail.launchError ? " wf-launch-message--error" : ""}`}
                data-testid="wf.launch.message"
                role="status"
                aria-live="polite"
              >
                {detail.launchMessage}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
