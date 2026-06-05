import type { DevToolsNode } from "./DevToolsNode";

/**
 * Collect every node id in a DevTools subtree. Used to expand the whole tree by
 * default — the snapshot tree is intentionally shown unfiltered.
 */
export function collectNodeIds(node: DevToolsNode, into: Set<number> = new Set()): Set<number> {
  into.add(node.id);
  for (const child of node.children) {
    collectNodeIds(child, into);
  }
  return into;
}
