import { useState } from "react";
import { ApprovalGate } from "./ApprovalGate";
import { useNodeDetail } from "./useNodeDetail";
import { stateColor, stateLabel } from "./stateColor";
import type { ApprovalSummary, RunEventLine, RunNode } from "./runState";

type InspectorTab = "output" | "diff" | "logs" | "props";

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "output", label: "Output" },
  { id: "diff", label: "Diff" },
  { id: "logs", label: "Logs" },
  { id: "props", label: "Props" },
];

function formatJson(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * The DETAIL pane. Shows the selected node's identity + state, an inline
 * approval gate when one is pending, and tabbed output / diff / logs / props.
 * Logs are filtered to the selected node when the stream tags node ids.
 */
export function RunInspector(props: {
  runId: string;
  node: RunNode;
  approval: ApprovalSummary | undefined;
  events: RunEventLine[];
  onApprovalResolved: () => void;
  onClose?: () => void;
}) {
  const { runId, node, approval, events, onApprovalResolved, onClose } = props;
  const [tab, setTab] = useState<InspectorTab>("logs");
  const detail = useNodeDetail(runId, node.id, node.iteration);

  const nodeLogs = events.filter((line) => !line.nodeId || line.nodeId === node.id);

  return (
    <div className="runs-inspector" data-testid="runs.inspector">
      <header className="runs-inspector-header">
        <div className="runs-inspector-identity">
          <span className="runs-inspector-tag" style={{ color: stateColor(node.state) }}>
            {node.name}
          </span>
          <span
            className="runs-status-pill"
            style={{ color: stateColor(node.state), borderColor: stateColor(node.state) }}
          >
            {stateLabel(node.state)}
          </span>
        </div>
        {onClose ? (
          <button
            type="button"
            className="runs-inspector-close"
            aria-label="Close inspector"
            data-testid="runs.inspector.close"
            onClick={onClose}
          >
            ✕
          </button>
        ) : null}
      </header>

      {approval ? (
        <ApprovalGate approval={approval} onResolved={onApprovalResolved} />
      ) : null}

      <nav className="runs-inspector-tabs" role="tablist" aria-label="Inspector tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`runs-inspector-tab${tab === entry.id ? " runs-inspector-tab--active" : ""}`}
            data-testid={`runs.inspector.tab.${entry.id}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="runs-inspector-body" data-testid={`runs.inspector.panel.${tab}`}>
        {tab === "output" ? (
          detail.loading ? (
            <p className="runs-inspector-hint">Loading output…</p>
          ) : detail.output ? (
            <pre className="runs-inspector-code">{formatJson(detail.output.row ?? detail.output)}</pre>
          ) : (
            <p className="runs-inspector-hint">{detail.error ?? "No output produced yet."}</p>
          )
        ) : null}

        {tab === "diff" ? (
          detail.diff && detail.diff.files && detail.diff.files.length > 0 ? (
            <div>
              <p className="runs-inspector-hint">
                {detail.diff.summary?.filesChanged ?? detail.diff.files.length} file(s) changed
              </p>
              {detail.diff.files.map((file) => (
                <pre className="runs-inspector-code" key={file.path}>
                  <span className="runs-inspector-diff-path">{file.path}</span>
                  {file.patch ? `\n${file.patch}` : ""}
                </pre>
              ))}
            </div>
          ) : (
            <p className="runs-inspector-hint">No diff for this node.</p>
          )
        ) : null}

        {tab === "logs" ? (
          nodeLogs.length > 0 ? (
            <pre className="runs-inspector-code runs-inspector-logs">
              {nodeLogs.map((line) => `${line.event}  ${line.message}`).join("\n")}
            </pre>
          ) : (
            <p className="runs-inspector-hint">No live log lines yet.</p>
          )
        ) : null}

        {tab === "props" ? (
          <pre className="runs-inspector-code">
            {formatJson({ id: node.id, type: node.type, state: node.state, keyProps: node.keyProps })}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
