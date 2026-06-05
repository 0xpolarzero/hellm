import type { DevToolsNode } from "../devtools/DevToolsNode";

export type DevToolsTreeRowProps = {
  node: DevToolsNode;
  selectedId: number | null;
  expanded: Set<number>;
  onSelect: (node: DevToolsNode) => void;
  onToggle: (id: number) => void;
};

const INDENT_PER_DEPTH = 14;

/**
 * Renders one DevTools node plus its (expanded) descendants. Dense, mono, and
 * unfiltered — this is a raw power-user tree, so every node type is shown with
 * its tag and a one-line key-prop summary.
 */
export function DevToolsTreeRow({ node, selectedId, expanded, onSelect, onToggle }: DevToolsTreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const propKeys = Object.keys(node.props);
  const summary = propKeys.length > 0 ? propKeys.slice(0, 4).join(" ") : "";

  return (
    <>
      <div
        className={`devtools-row${isSelected ? " devtools-row-selected" : ""}`}
        data-testid={`devtools.row.${node.id}`}
        style={{ paddingLeft: `${node.depth * INDENT_PER_DEPTH + 8}px` }}
        onClick={() => onSelect(node)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node);
          }
        }}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        <button
          type="button"
          className="devtools-chevron"
          data-has-children={hasChildren ? "true" : "false"}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          aria-label={hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined}
          tabIndex={hasChildren ? 0 : -1}
        >
          {hasChildren ? (isOpen ? "▾" : "▸") : ""}
        </button>
        <span className={`devtools-tag devtools-type-${node.type}`}>{`<${node.name}>`}</span>
        {node.task ? <span className="devtools-kind">{node.task.kind}</span> : null}
        {summary ? <span className="devtools-summary">{summary}</span> : null}
      </div>
      {hasChildren && isOpen
        ? node.children.map((child) => (
            <DevToolsTreeRow
              key={child.id}
              node={child}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}
