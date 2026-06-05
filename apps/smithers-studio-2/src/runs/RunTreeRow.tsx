import { isRunningState, type RunNode } from "./runState";
import { stateColor } from "./stateColor";

const INDENT_PER_DEPTH = 16;

function hasFailedDescendant(node: RunNode): boolean {
  return node.children.some(
    (child) => child.state === "failed" || hasFailedDescendant(child),
  );
}

/**
 * One tree row. Renders depth indent, an expand chevron only when the node has
 * children (with a danger dot when a descendant failed), the state-colored mono
 * node tag, and a key-props summary. Running leaf nodes get the running cursor:
 * a 2px accent left bar + pulsing play glyph + one-line last-log.
 */
export function RunTreeRow(props: {
  node: RunNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  lastLog: string | undefined;
  onSelect: (nodeId: string) => void;
  onToggle: (nodeId: string) => void;
}) {
  const { node, depth, selected, expanded, lastLog, onSelect, onToggle } = props;
  const hasChildren = node.children.length > 0;
  const isLeaf = !hasChildren;
  const running = isRunningState(node.state);
  const showCursor = running && isLeaf;
  const failedBelow = hasChildren && hasFailedDescendant(node);
  // The snapshot tree carries no per-node log, so the running cursor's last-log
  // line comes solely from the live event stream (lastLogByNode).
  const log = lastLog;

  return (
    <div
      className={`runs-tree-row${selected ? " runs-tree-row--selected" : ""}${showCursor ? " runs-tree-row--running" : ""}`}
      data-testid={`tree.row.${node.id}`}
      data-state={node.state}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
    >
      <span className="runs-tree-indent" style={{ width: depth * INDENT_PER_DEPTH }} />
      {hasChildren ? (
        <button
          className="runs-tree-chevron"
          type="button"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.id);
          }}
        >
          <span className={`runs-tree-chevron-glyph${expanded ? " runs-tree-chevron-glyph--open" : ""}`}>
            ▸
          </span>
          {failedBelow ? <span className="runs-tree-fail-dot" aria-hidden /> : null}
        </button>
      ) : (
        <span className="runs-tree-chevron runs-tree-chevron--leaf" aria-hidden>
          {showCursor ? <span className="runs-tree-pulse">▶</span> : <span className="runs-tree-bullet">·</span>}
        </span>
      )}
      <span className="runs-tree-node">
        <span className="runs-tree-tag" style={{ color: stateColor(node.state) }}>
          {node.name}
        </span>
        {node.keyProps ? <span className="runs-tree-props">{node.keyProps}</span> : null}
        {showCursor && log ? <span className="runs-tree-lastlog">{log}</span> : null}
      </span>
    </div>
  );
}
