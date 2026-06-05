import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { RunTreeRow } from "./RunTreeRow";
import type { RunNode } from "./runState";

/** Flatten the visible (expanded) portion of the tree into rows for rendering. */
function flatten(
  node: RunNode,
  depth: number,
  expanded: Set<string>,
  out: Array<{ node: RunNode; depth: number }>,
): void {
  out.push({ node, depth });
  if (expanded.has(node.id)) {
    for (const child of node.children) flatten(child, depth + 1, expanded, out);
  }
}

function collectIds(node: RunNode, into: Set<string>): void {
  into.add(node.id);
  for (const child of node.children) collectIds(child, into);
}

/**
 * The run tree pane. Expands every node by default (an ops console wants the
 * whole run visible), tracks expansion + selection locally, and renders one
 * RunTreeRow per visible node.
 */
export function RunTree(props: {
  tree: RunNode | null;
  selectedNodeId: string | undefined;
  lastLogByNode: Map<string, string>;
  onSelectNode: (nodeId: string) => void;
}) {
  const { tree, selectedNodeId, lastLogByNode, onSelectNode } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Expand all nodes whenever a new tree arrives.
  useEffect(() => {
    if (!tree) {
      setExpanded(new Set());
      return;
    }
    const ids = new Set<string>();
    collectIds(tree, ids);
    setExpanded(ids);
  }, [tree]);

  if (!tree) {
    return <div className="runs-tree-empty">No node tree for this run yet.</div>;
  }

  const rows: Array<{ node: RunNode; depth: number }> = [];
  flatten(tree, 0, expanded, rows);

  const toggle = (nodeId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Roving-focus keyboard navigation over the visible rows: Up/Down move the
  // selection (and focus) between rows, Right expands / descends, Left collapses
  // / ascends, Home/End jump to the ends. This makes the tree operable without a
  // pointer (the accessible-tree pattern from UX.md).
  const focusRow = (nodeId: string) => {
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-testid="tree.row.${CSS.escape(nodeId)}"]`)
        ?.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = rows.findIndex(({ node }) => node.id === selectedNodeId);
    const current = index >= 0 ? rows[index].node : undefined;
    const move = (target: number) => {
      const next = rows[target];
      if (!next) return;
      event.preventDefault();
      onSelectNode(next.node.id);
      focusRow(next.node.id);
    };
    switch (event.key) {
      case "ArrowDown":
        return move(index < 0 ? 0 : index + 1);
      case "ArrowUp":
        return move(index <= 0 ? 0 : index - 1);
      case "Home":
        return move(0);
      case "End":
        return move(rows.length - 1);
      case "ArrowRight":
        if (current && current.children.length > 0 && !expanded.has(current.id)) {
          event.preventDefault();
          toggle(current.id);
        } else if (current && current.children.length > 0) {
          move(index + 1);
        }
        return;
      case "ArrowLeft":
        if (current && current.children.length > 0 && expanded.has(current.id)) {
          event.preventDefault();
          toggle(current.id);
        }
        return;
      default:
        return;
    }
  };

  return (
    <div
      className="runs-tree"
      role="tree"
      aria-label="Run node tree"
      ref={containerRef}
      onKeyDown={onKeyDown}
    >
      {rows.map(({ node, depth }) => (
        <RunTreeRow
          key={node.id}
          node={node}
          depth={depth}
          selected={node.id === selectedNodeId}
          expanded={expanded.has(node.id)}
          lastLog={lastLogByNode.get(node.id)}
          onSelect={onSelectNode}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}
