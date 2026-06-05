import { useState } from "react";
import { isTerminalState, type RunStateView } from "./runState";
import { stateColor, stateLabel } from "./stateColor";
import { useRunActions } from "./useRunActions";

/** Which view the live run is showing: the workflow's own UI, or the default tree/inspector. */
export type RunViewMode = "workflow" | "default";

/**
 * The selected-run toolbar: workflow + state, plus the lifecycle actions that
 * make sense for the current state (cancel a live run, resume a terminal one)
 * and a frame scrubber for time-travel rewind when the run reports frames.
 *
 * When the run's workflow ships its own UI, the toolbar also carries the
 * view toggle that swaps between that UI and the default tree/inspector view.
 */
export function RunToolbar(props: {
  run: RunStateView;
  streaming: boolean;
  onChanged: () => void;
  /** Whether the run's workflow ships a custom UI (controls toggle visibility). */
  customUiAvailable: boolean;
  viewMode: RunViewMode;
  onViewModeChange: (mode: RunViewMode) => void;
}) {
  const { run, streaming, onChanged, customUiAvailable, viewMode, onViewModeChange } = props;
  const actions = useRunActions();
  const [busy, setBusy] = useState(false);
  const terminal = isTerminalState(run.state);
  const frameCount = run.frameCount ?? 0;

  const guarded = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="runs-toolbar" data-testid="runs.toolbar">
      <div className="runs-toolbar-identity">
        <span className="runs-toolbar-title">{run.workflowKey ?? "Live Run"}</span>
        <span
          className="runs-status-pill"
          style={{ color: stateColor(run.state), borderColor: stateColor(run.state) }}
          data-testid="runs.toolbar.state"
        >
          {stateLabel(run.state)}
        </span>
        {streaming ? (
          <span className="runs-toolbar-live" title="Receiving live events over the run socket">
            live
          </span>
        ) : !terminal ? (
          <span
            className="runs-toolbar-polling"
            title="No live socket — polling this run's state every 2s"
            data-testid="runs.toolbar.polling"
          >
            polling
          </span>
        ) : null}
      </div>
      <div className="runs-toolbar-actions">
        {customUiAvailable ? (
          <div
            className="runs-view-toggle"
            role="group"
            aria-label="Run view"
            data-testid="runs.toolbar.viewToggle"
          >
            <button
              type="button"
              className="runs-view-toggle-btn"
              aria-pressed={viewMode === "workflow"}
              data-testid="runs.toolbar.viewToggle.workflow"
              onClick={() => onViewModeChange("workflow")}
            >
              Workflow UI
            </button>
            <button
              type="button"
              className="runs-view-toggle-btn"
              aria-pressed={viewMode === "default"}
              data-testid="runs.toolbar.viewToggle.default"
              onClick={() => onViewModeChange("default")}
            >
              Default
            </button>
          </div>
        ) : null}
        {!terminal ? (
          <button
            type="button"
            className="runs-toolbar-btn runs-toolbar-btn--danger"
            disabled={busy}
            title={busy ? "Working…" : "Halt this run's agents and finalize it as cancelled"}
            data-testid="runs.toolbar.cancel"
            onClick={() => void guarded(() => actions.cancelRun(run.runId))}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="runs-toolbar-btn"
            disabled={busy}
            title={busy ? "Working…" : "Re-enter this finished run and continue execution"}
            data-testid="runs.toolbar.resume"
            onClick={() => void guarded(() => actions.resumeRun(run.runId))}
          >
            Resume
          </button>
        )}
        {frameCount > 1 ? (
          <button
            type="button"
            className="runs-toolbar-btn"
            disabled={busy}
            title={busy ? "Working…" : `Rewind to frame ${frameCount - 1} of ${frameCount} (time-travel)`}
            data-testid="runs.toolbar.rewind"
            onClick={() => void guarded(() => actions.rewindRun(run.runId, frameCount - 1))}
          >
            Rewind
          </button>
        ) : null}
      </div>
    </div>
  );
}
