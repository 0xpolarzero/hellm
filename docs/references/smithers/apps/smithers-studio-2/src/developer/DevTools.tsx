import { useEffect, useMemo, useState } from "react";
import "./devtools.css";
import { useDevToolsSnapshot } from "./useDevToolsSnapshot";
import { DevToolsTreeRow } from "./DevToolsTreeRow";
import { DevToolsNodeInspector } from "./DevToolsNodeInspector";
import { collectNodeIds } from "../devtools/collectNodeIds";
import type { DevToolsNode } from "../devtools/DevToolsNode";

/**
 * DevTools — raw, unfiltered DevTools snapshot tree + node props. Developer-gated
 * (registered only when developerMode is on). Wires to the gateway
 * `getDevToolsSnapshot` RPC for a run picked from `listRuns`.
 */
export function DevTools() {
  const { runs, selectedRunId, snapshot, loadingRuns, loadingSnapshot, error, selectRun, refresh } =
    useDevToolsSnapshot();
  const [selected, setSelected] = useState<DevToolsNode | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (snapshot?.root) {
      setExpanded(collectNodeIds(snapshot.root));
      setSelected(snapshot.root);
    } else {
      setExpanded(new Set());
      setSelected(null);
    }
  }, [snapshot]);

  const toggle = useMemo(
    () => (id: number) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  return (
    <section className="devtools-surface" data-testid="view.devtools">
      <header className="devtools-header">
        <h2 className="devtools-title">DevTools</h2>
        <div className="devtools-controls">
          <label className="devtools-runlabel" htmlFor="devtools-run-select">
            Run
          </label>
          <select
            id="devtools-run-select"
            className="devtools-runselect"
            data-testid="devtools.run-select"
            value={selectedRunId ?? ""}
            onChange={(event) => selectRun(event.target.value)}
            disabled={loadingRuns || runs.length === 0}
          >
            {runs.length === 0 ? <option value="">No runs</option> : null}
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.runId}
                {run.workflowKey ? ` · ${run.workflowKey}` : ""}
                {run.status ? ` · ${run.status}` : ""}
              </option>
            ))}
          </select>
          <button type="button" className="devtools-refresh" data-testid="devtools.refresh" onClick={refresh}>
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="devtools-error" data-testid="devtools.error">
          {error}
        </div>
      ) : null}

      <div className="devtools-body">
        <div className="devtools-tree" data-testid="devtools.tree" role="tree">
          {loadingRuns || loadingSnapshot ? (
            <div className="devtools-loading" data-testid="devtools.loading">
              Loading snapshot…
            </div>
          ) : snapshot?.root ? (
            <DevToolsTreeRow
              node={snapshot.root}
              selectedId={selected?.id ?? null}
              expanded={expanded}
              onSelect={setSelected}
              onToggle={toggle}
            />
          ) : (
            <div className="devtools-empty" data-testid="devtools.tree-empty">
              {error ? "Snapshot unavailable." : "No snapshot for this run yet."}
            </div>
          )}
        </div>
        <div className="devtools-pane">
          <DevToolsNodeInspector node={selected} />
        </div>
      </div>
    </section>
  );
}
