import { useMemo, useState } from "react";
import type { DevToolsNode } from "../devtools/DevToolsNode";

export type DevToolsNodeInspectorProps = {
  node: DevToolsNode | null;
};

/** Above this many characters a value is collapsed behind an expand toggle. */
const VALUE_CAP = 2_000;

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * One prop value cell. Pretty-printed JSON is capped at {@link VALUE_CAP} chars
 * so a multi-megabyte prop cannot freeze the layout; the full text is revealed
 * on demand. Formatting is done once by the parent (memoized by node id) and
 * passed in as a string, so re-expanding never re-stringifies.
 */
function PropValueCell({ formatted }: { formatted: string }) {
  const [expanded, setExpanded] = useState(false);
  const oversized = formatted.length > VALUE_CAP;
  const shown = !oversized || expanded ? formatted : `${formatted.slice(0, VALUE_CAP)}…`;
  return (
    <>
      <pre className="devtools-props">{shown}</pre>
      {oversized ? (
        <button
          type="button"
          className="devtools-prop-expand"
          data-testid="devtools.prop.expand"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Collapse" : `Expand (${formatted.length.toLocaleString()} chars)`}
        </button>
      ) : null}
    </>
  );
}

/**
 * Right-hand pane showing the raw, unfiltered props of the selected DevTools
 * node plus its task metadata. Values are pretty-printed JSON, capped with an
 * expand affordance, and the (potentially expensive) stringification is
 * memoized by node id so re-renders for the same node never re-serialize.
 */
export function DevToolsNodeInspector({ node }: DevToolsNodeInspectorProps) {
  const formatted = useMemo(() => {
    if (!node) return null;
    return {
      task: node.task != null ? formatValue(node.task) : null,
      props: Object.entries(node.props).map(([key, value]) => [key, formatValue(value)] as const),
    };
    // Keyed by the node object: re-formats only when the selected node (or its
    // freshly-fetched data) actually changes, so an unrelated parent re-render
    // — selection elsewhere, expand toggle in a sibling — never re-stringifies
    // a multi-megabyte prop. A live snapshot refresh hands us a new node object,
    // so updated props for the SAME id still re-format correctly.
  }, [node]);

  if (!node || !formatted) {
    return (
      <div className="devtools-inspector-empty" data-testid="devtools.inspector.empty">
        Select a node to inspect its props.
      </div>
    );
  }

  return (
    <div className="devtools-inspector" data-testid="devtools.inspector">
      <div className="devtools-inspector-head">
        <span className={`devtools-tag devtools-type-${node.type}`}>{`<${node.name}>`}</span>
        <span className="devtools-inspector-meta">{`#${node.id} · ${node.type} · depth ${node.depth}`}</span>
      </div>
      {formatted.task ? (
        <div className="devtools-inspector-section" data-testid="devtools.inspector.task">
          <div className="devtools-inspector-label">task</div>
          <PropValueCell formatted={formatted.task} />
        </div>
      ) : null}
      <div className="devtools-inspector-section">
        <div className="devtools-inspector-label">props ({formatted.props.length})</div>
        {formatted.props.length === 0 ? (
          <div className="devtools-inspector-emptyprops">No props.</div>
        ) : (
          <table className="devtools-proptable">
            <tbody>
              {formatted.props.map(([key, value]) => (
                <tr key={key}>
                  <td className="devtools-propkey">{key}</td>
                  <td className="devtools-propval">
                    <PropValueCell formatted={value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
